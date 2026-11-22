// Проверочная схема движка (не пример для пользователя). Ожидаемое поведение:
// out — младшие четыре разряда счётчика тактов, меняется на каждом такте;
// wide — счётчик Джонсона в 70 разрядов: за такт в младший разряд вдвигается единица;
// seen — поднимается по переднему фронту входа en. Вход подтянут вверх с самого начала,
// фронта на нём нет, поэтому seen остаётся нулём;
// на такте 201 (счётчик равен 200) модель вызывает $finish.
module top (
    input  wire       clk,
    input  wire       en,
    output wire [3:0] out,
    output wire       seen
);
    reg [7:0]  cnt = 0;
    reg [69:0] wide = 0;
    reg        en_rose = 0;

    always @(posedge clk) begin
        cnt  <= cnt + 1'b1;
        wide <= {wide[68:0], ~wide[69]};
        if (cnt == 8'd200) $finish;
    end

    always @(posedge en) en_rose <= 1'b1;

    assign out  = cnt[3:0];
    assign seen = en_rose;
endmodule
